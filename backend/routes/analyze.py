from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import date as date_type
from typing import Optional
from collections import Counter
from itertools import combinations
import json

from database import get_db
from models import ActivityLog
import stats as stats_module
import anthropic
import os

router = APIRouter()
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

SYSTEM_PROMPT = (
    "You are a personal health and activity data analyst. "
    "You help users find patterns, correlations, and insights in their daily activity logs "
    "(e.g. sleep, exercise, work, meals). "
    "Use the provided tools to fetch only the statistics you actually need to answer the question. "
    "Be specific — reference actual numbers, dates, and p-values where relevant. "
    "Interpret statistical significance plainly (e.g. p=0.03 means the result is unlikely due to chance). "
    "Keep responses concise and actionable."
)

# ── Tool schemas ────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "get_activity_summary",
        "description": (
            "Compute count, mean/median/std duration, total duration, and most common "
            "start hour for a single activity type. Use this first to get a baseline "
            "before asking for correlations or t-tests."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "activity_type": {"type": "string", "description": "Must be one of the available types."},
                "start_date": {"type": "string", "description": "ISO date YYYY-MM-DD, inclusive. Omit for all history."},
                "end_date": {"type": "string", "description": "ISO date YYYY-MM-DD, inclusive. Omit for up to today."},
            },
            "required": ["activity_type"],
        },
    },
    {
        "name": "get_activity_frequency",
        "description": (
            "Get how often an activity occurs: average days per week and breakdown by "
            "day of the week. Use when the question is about consistency, habit patterns, "
            "or which days something typically happens."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "activity_type": {"type": "string"},
                "start_date": {"type": "string"},
                "end_date": {"type": "string"},
            },
            "required": ["activity_type"],
        },
    },
    {
        "name": "get_daily_series",
        "description": (
            "Retrieve the day-by-day total duration for a single activity type. "
            "Use when the question asks about trends over time, specific dates, or "
            "when you need raw time-series data to reason about patterns."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "activity_type": {"type": "string"},
                "start_date": {"type": "string"},
                "end_date": {"type": "string"},
            },
            "required": ["activity_type"],
        },
    },
    {
        "name": "get_correlation",
        "description": (
            "Compute the Pearson correlation coefficient and two-tailed p-value between "
            "the daily totals of two activity types. Call this only when the question "
            "explicitly asks about a relationship or correlation between two types. "
            "Requires at least 5 overlapping days with duration data."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "type_a": {"type": "string", "description": "First activity type."},
                "type_b": {"type": "string", "description": "Second activity type."},
                "start_date": {"type": "string"},
                "end_date": {"type": "string"},
            },
            "required": ["type_a", "type_b"],
        },
    },
    {
        "name": "compare_groups",
        "description": (
            "Run a Welch t-test comparing the daily total durations of two activity types. "
            "Use when the user asks whether one activity is significantly longer/shorter "
            "than another, or asks about statistical significance between two groups."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "type_a": {"type": "string"},
                "type_b": {"type": "string"},
                "start_date": {"type": "string"},
                "end_date": {"type": "string"},
            },
            "required": ["type_a", "type_b"],
        },
    },
]


# ── Helpers ─────────────────────────────────────────────────────────────────

def _parse_date(s: Optional[str]) -> Optional[date_type]:
    return date_type.fromisoformat(s) if s else None


def _hydrate(logs) -> list[dict]:
    return [
        {
            "activity_type": l.activity_type,
            "started_at": l.started_at,
            "ended_at": l.ended_at,
            "duration_minutes": l.duration_minutes,
            "notes": l.notes,
        }
        for l in logs
    ]


def _dispatch(tool_name: str, tool_input: dict, logs_data: list[dict]) -> str:
    start = _parse_date(tool_input.get("start_date"))
    end = _parse_date(tool_input.get("end_date"))

    if tool_name == "get_activity_summary":
        result = stats_module.compute_summary(logs_data, tool_input["activity_type"], start, end)

    elif tool_name == "get_activity_frequency":
        result = stats_module.get_frequency(logs_data, tool_input["activity_type"], start, end)

    elif tool_name == "get_daily_series":
        result = stats_module.daily_series(logs_data, tool_input["activity_type"], start, end)

    elif tool_name == "get_correlation":
        sa = stats_module.daily_series(logs_data, tool_input["type_a"], start, end)
        sb = stats_module.daily_series(logs_data, tool_input["type_b"], start, end)
        vals_a, vals_b = stats_module.align_series(sa, sb)
        if len(vals_a) < 5:
            result = {"error": f"Only {len(vals_a)} overlapping days with duration data — need at least 5."}
        else:
            result = stats_module.compute_pearson(vals_a, vals_b)

    elif tool_name == "compare_groups":
        sa = stats_module.daily_series(logs_data, tool_input["type_a"], start, end)
        sb = stats_module.daily_series(logs_data, tool_input["type_b"], start, end)
        if len(sa) < 2 or len(sb) < 2:
            result = {"error": "Not enough data in one or both series for a t-test (need ≥2 days each)."}
        else:
            result = stats_module.run_ttest(list(sa.values()), list(sb.values()))

    else:
        result = {"error": f"Unknown tool: {tool_name}"}

    return json.dumps(result)


# ── Pydantic models ──────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    question: str


class CorrelationsRequest(BaseModel):
    types: list[str]
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    lag_days: int = 0
    windows: dict[str, int] = {}   # type -> rolling window size (1 = no rolling)


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/")
def analyze(request: AnalyzeRequest, db: Session = Depends(get_db)):
    logs = db.query(ActivityLog).order_by(ActivityLog.started_at.desc()).limit(500).all()
    if not logs:
        return {"answer": "No activity data found. Log some activities first!"}

    logs_data = _hydrate(logs)

    # Build a compact metadata context for Claude — not the raw logs
    type_counts = Counter(l["activity_type"] for l in logs_data)
    available_types = [{"type": t, "log_count": c} for t, c in sorted(type_counts.items())]
    dates = [l["started_at"].date() for l in logs_data]
    metadata_text = (
        f"Available activity types: {json.dumps(available_types)}\n"
        f"Data range: {min(dates).isoformat()} to {max(dates).isoformat()}\n"
        f"Total logs: {len(logs_data)}"
    )

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": metadata_text,
                    "cache_control": {"type": "ephemeral"},
                },
                {
                    "type": "text",
                    "text": f"Question: {request.question}",
                },
            ],
        }
    ]

    # Tool-use loop — runs until Claude signals end_turn
    while True:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            text_blocks = [b for b in response.content if b.type == "text"]
            return {"answer": text_blocks[-1].text if text_blocks else ""}

        if response.stop_reason != "tool_use":
            text_blocks = [b for b in response.content if b.type == "text"]
            return {"answer": text_blocks[-1].text if text_blocks else "No answer generated."}

        # Execute all tool calls in this turn and collect results
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": _dispatch(block.name, block.input, logs_data),
                })
        messages.append({"role": "user", "content": tool_results})


@router.post("/correlations")
def analyze_correlations(request: CorrelationsRequest, db: Session = Depends(get_db)):
    if len(request.types) < 2:
        raise HTTPException(status_code=422, detail="Provide at least 2 activity types.")

    logs = db.query(ActivityLog).order_by(ActivityLog.started_at.desc()).limit(500).all()
    logs_data = _hydrate(logs)

    start = _parse_date(request.start_date)
    end = _parse_date(request.end_date)

    pairs = []
    for type_a, type_b in combinations(request.types, 2):
        sa = stats_module.daily_series(logs_data, type_a, start, end)
        sb = stats_module.daily_series(logs_data, type_b, start, end)
        wa = request.windows.get(type_a, 1)
        wb = request.windows.get(type_b, 1)
        if wa > 1:
            sa = stats_module.rolling_aggregate(sa, wa)
        if wb > 1:
            sb = stats_module.rolling_aggregate(sb, wb)
        vals_a, vals_b = stats_module.align_series(sa, sb, lag_days=request.lag_days)
        n = len(vals_a)

        if n < 5:
            pairs.append({
                "type_a": type_a,
                "type_b": type_b,
                "r": None,
                "p_value": None,
                "n": n,
                "significant": False,
                "warning": f"Only {n} overlapping day{'s' if n != 1 else ''} with duration data (need ≥5).",
            })
        else:
            result = stats_module.compute_pearson(vals_a, vals_b)
            pairs.append({
                "type_a": type_a,
                "type_b": type_b,
                "r": result["r"],
                "p_value": result["p_value"],
                "n": result["n"],
                "significant": result["p_value"] < 0.05,
                "warning": None,
            })

    # Single Claude call to interpret the matrix
    pairs_text = json.dumps(pairs, indent=2)
    interp = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": (
                f"Here are Pearson correlation results between activity types:\n\n{pairs_text}\n\n"
                + (f"Note: series B in each pair was lagged by {request.lag_days} day(s) "
                   f"(each pair tests whether B from {request.lag_days} day(s) ago predicts today's A).\n\n"
                   if request.lag_days else "")
                + (f"Note: rolling windows applied — "
                   + ", ".join(f"{t}: {w}-day sum" for t, w in request.windows.items() if w > 1)
                   + ".\n\n"
                   if any(w > 1 for w in request.windows.values()) else "")
                + "In 2-4 sentences, interpret what these correlations mean for the user's daily habits. "
                "Explicitly flag which results are statistically significant (p < 0.05) and which lack "
                "enough data. Be concrete and actionable."
            ),
        }],
    )

    return {
        "pairs": pairs,
        "interpretation": interp.content[0].text,
        "start_date": request.start_date,
        "end_date": request.end_date,
    }
