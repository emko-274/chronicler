# Deferred Features

## Insights / AI Analyzer

### Multi-turn conversation memory
Each question sent to `/analyze` is currently stateless — the full log data is re-sent with every request and Claude has no memory of prior questions in the session. Implementing persistent conversation history would allow follow-up questions like "what about last month instead?" or "break that down by weekday."
- Backend: maintain a conversation thread per session (session ID in request, store message history server-side or pass it back to the client to re-send)
- Frontend: thread `messages` state back through the API call instead of discarding prior exchanges

### Lagged correlations
Standard Pearson correlation checks whether two variables move together on the *same* day. Lagged correlation checks whether one variable predicts another N days later — e.g. "does a long exercise session today correlate with better sleep tomorrow?"
- Implement as an offset parameter in `align_series(a, b, lag_days=0)` in `stats.py`
- Expose a lag selector (0–7 days) in the correlation panel UI
- Useful pairs to highlight automatically: exercise → sleep, caffeine → sleep, work → exercise

### Correlation visualizations
Currently the correlation panel returns a text matrix and an AI interpretation paragraph. Richer output could include:
- Scatter plots of two daily time series (e.g. exercise duration vs. sleep duration, one dot per day)
- A color-coded heatmap of the full correlation matrix
- Trend lines overlaid on the timeline chart in the Dashboard for two selected types
- Implementation path: use `react-native-svg` (already a dependency) to render scatter plots; the correlation matrix heatmap is a grid of colored `Rect` elements
