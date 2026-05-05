"""
Pure statistical functions for activity log analysis.
All functions accept an in-memory list of log dicts — no DB access.
Each dict has keys: activity_type, started_at (datetime), ended_at (datetime|None),
duration_minutes (int|None), notes (str|None).
"""

from datetime import date as date_type
from statistics import mean, median, stdev
from typing import Optional
from scipy import stats as scipy_stats


def _filter(logs: list[dict], activity_type: str,
            start: Optional[date_type], end: Optional[date_type]) -> list[dict]:
    result = [l for l in logs if l["activity_type"] == activity_type]
    if start:
        result = [l for l in result if l["started_at"].date() >= start]
    if end:
        result = [l for l in result if l["started_at"].date() <= end]
    return result


def daily_series(
    logs: list[dict],
    activity_type: str,
    start: Optional[date_type] = None,
    end: Optional[date_type] = None,
) -> dict[str, float]:
    """
    Returns { "YYYY-MM-DD": total_duration_minutes } for days with at least one
    entry that has a non-None duration_minutes. Days with only null durations
    are excluded so callers always work with meaningful values.
    """
    filtered = _filter(logs, activity_type, start, end)
    series: dict[str, float] = {}
    for log in filtered:
        if log["duration_minutes"] is None:
            continue
        key = log["started_at"].date().isoformat()
        series[key] = series.get(key, 0.0) + log["duration_minutes"]
    return series


def align_series(
    a: dict[str, float],
    b: dict[str, float],
) -> tuple[list[float], list[float]]:
    """
    Returns (values_a, values_b) for the intersection of dates, in chronological order.
    Returns ([], []) when there is no overlap.
    """
    common = sorted(set(a.keys()) & set(b.keys()))
    return [a[d] for d in common], [b[d] for d in common]


def compute_pearson(vals_a: list[float], vals_b: list[float]) -> dict:
    """
    Pearson r + two-tailed p-value via scipy.stats.pearsonr.
    Caller must ensure len(vals_a) >= 2.
    Returns { "r": float, "p_value": float, "n": int }.
    """
    r, p = scipy_stats.pearsonr(vals_a, vals_b)
    return {"r": round(float(r), 4), "p_value": round(float(p), 4), "n": len(vals_a)}


def compute_summary(
    logs: list[dict],
    activity_type: str,
    start: Optional[date_type] = None,
    end: Optional[date_type] = None,
) -> dict:
    """
    Descriptive statistics for one activity type.
    Returns:
      { count, mean_duration, median_duration, std_duration,
        most_common_hour, total_duration }
    Duration fields are in minutes. Fields are None when no data.
    """
    filtered = _filter(logs, activity_type, start, end)
    durations = [l["duration_minutes"] for l in filtered if l["duration_minutes"] is not None]
    hours = [l["started_at"].hour for l in filtered]

    return {
        "count": len(filtered),
        "mean_duration": round(mean(durations), 1) if durations else None,
        "median_duration": round(median(durations), 1) if durations else None,
        "std_duration": round(stdev(durations), 1) if len(durations) >= 2 else None,
        "total_duration": round(sum(durations), 1) if durations else None,
        "most_common_hour": max(set(hours), key=hours.count) if hours else None,
    }


def run_ttest(vals_a: list[float], vals_b: list[float]) -> dict:
    """
    Welch independent-samples t-test (equal_var=False).
    Returns { "t_stat": float, "p_value": float, "n_a": int, "n_b": int }.
    Caller must ensure both lists have at least 2 elements.
    """
    t, p = scipy_stats.ttest_ind(vals_a, vals_b, equal_var=False)
    return {
        "t_stat": round(float(t), 4),
        "p_value": round(float(p), 4),
        "n_a": len(vals_a),
        "n_b": len(vals_b),
    }


def get_frequency(
    logs: list[dict],
    activity_type: str,
    start: Optional[date_type] = None,
    end: Optional[date_type] = None,
) -> dict:
    """
    Returns:
      { "days_per_week": float,
        "weekday_distribution": { "Mon": int, "Tue": int, ... } }
    days_per_week counts distinct calendar days with at least one entry, averaged
    over the number of full weeks in the date range.
    """
    filtered = _filter(logs, activity_type, start, end)
    if not filtered:
        return {"days_per_week": 0.0, "weekday_distribution": {d: 0 for d in
                ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}}

    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    weekday_dist = {d: 0 for d in day_names}
    for log in filtered:
        weekday_dist[day_names[log["started_at"].weekday()] ] += 1

    distinct_days = {l["started_at"].date() for l in filtered}
    all_dates = sorted(distinct_days)
    if len(all_dates) >= 2:
        span_days = (all_dates[-1] - all_dates[0]).days + 1
        weeks = max(span_days / 7, 1)
    else:
        weeks = 1
    days_per_week = round(len(distinct_days) / weeks, 2)

    return {"days_per_week": days_per_week, "weekday_distribution": weekday_dist}
