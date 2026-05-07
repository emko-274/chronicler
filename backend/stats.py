"""
Pure statistical functions for activity log analysis.
All functions accept an in-memory list of log dicts — no DB access.
Each dict has keys: activity_type, started_at (datetime), ended_at (datetime|None),
duration_minutes (int|None), notes (str|None).
"""

import math
from datetime import date as date_type, timedelta
from statistics import mean, median, stdev
from typing import Optional
import numpy as np
from scipy import stats as scipy_stats
import statsmodels.api as sm


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


def rolling_aggregate(series: dict[str, float], window: int) -> dict[str, float]:
    """
    For each date D in the series, replace its value with the sum of all logged
    values from D-(window-1) through D. Days with no log within the window
    contribute 0. Days that have no data anywhere in their window are dropped.
    """
    if window <= 1:
        return series
    result: dict[str, float] = {}
    for d_str in series:
        d = date_type.fromisoformat(d_str)
        total = sum(
            series.get((d - timedelta(days=w)).isoformat(), 0.0)
            for w in range(window)
        )
        result[d_str] = total
    return result


def align_series(
    a: dict[str, float],
    b: dict[str, float],
    lag_days: int = 0,
) -> tuple[list[float], list[float]]:
    """
    Returns (values_a, values_b) aligned in chronological order.
    lag_days > 0: pair a[d] with b[d - lag_days] (does B from N days ago predict today's A?).
    lag_days = 0: standard same-day alignment.
    Returns ([], []) when there is no overlap.
    """
    if lag_days == 0:
        common = sorted(set(a.keys()) & set(b.keys()))
        return [a[d] for d in common], [b[d] for d in common]

    result_a, result_b = [], []
    for d_str in sorted(a.keys()):
        lagged = (date_type.fromisoformat(d_str) - timedelta(days=lag_days)).isoformat()
        if lagged in b:
            result_a.append(a[d_str])
            result_b.append(b[lagged])
    return result_a, result_b


def log_transform(series: dict[str, float]) -> dict[str, float]:
    """Apply log1p (natural log of 1+x) to each value — handles zeros safely."""
    return {k: math.log1p(v) for k, v in series.items()}


def align_multiple(series_list: list[dict[str, float]]) -> list[list[float]]:
    """
    Find dates present in ALL series and return one value-list per series,
    all in chronological order. Returns [] when no common dates exist.
    """
    if not series_list:
        return []
    common = sorted(set.intersection(*(set(s.keys()) for s in series_list)))
    return [[s[d] for d in common] for s in series_list]


def run_ols(
    y: list[float],
    X_cols: list[list[float]],
    predictor_names: list[str],
) -> dict:
    """
    OLS regression of y on X_cols (intercept added automatically).
    Returns n, R², adjusted R², F-stat, F p-value, and one row per term.
    """
    X = sm.add_constant(np.column_stack(X_cols), has_constant='add')
    model = sm.OLS(y, X).fit()
    terms = ["intercept"] + predictor_names
    coefficients = [
        {
            "name": terms[i],
            "coef": round(float(model.params[i]), 4),
            "std_err": round(float(model.bse[i]), 4),
            "t_stat": round(float(model.tvalues[i]), 3),
            "p_value": round(float(model.pvalues[i]), 4),
        }
        for i in range(len(terms))
    ]
    return {
        "n": int(len(y)),
        "r_squared": round(float(model.rsquared), 4),
        "adj_r_squared": round(float(model.rsquared_adj), 4),
        "f_stat": round(float(model.fvalue), 3),
        "f_pvalue": round(float(model.f_pvalue), 4),
        "coefficients": coefficients,
    }


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
