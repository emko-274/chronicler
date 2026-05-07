import axios from 'axios';

// In development, points to your local backend.
// When you deploy, set EXPO_PUBLIC_API_URL to your hosted backend URL.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({ baseURL: API_BASE_URL });

export interface ActivityLog {
  id: string;
  activity_type: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  notes: string | null;
  extra_data: Record<string, unknown> | null;
  created_at: string;
}

export interface CreateActivityLog {
  activity_type: string;
  started_at: string;
  ended_at?: string;
  duration_minutes?: number;
  notes?: string;
  extra_data?: Record<string, unknown>;
}

export const getLogs = (activity_type?: string, limit = 100): Promise<ActivityLog[]> =>
  api.get('/logs', { params: { activity_type, limit } }).then((r) => r.data);

export const createLog = (log: CreateActivityLog): Promise<ActivityLog> =>
  api.post('/logs', log).then((r) => r.data);

export const deleteLog = (id: string): Promise<void> =>
  api.delete(`/logs/${id}`).then((r) => r.data);

export interface UpdateActivityLog {
  activity_type?: string;
  started_at?: string;
  ended_at?: string | null;
  notes?: string | null;
  extra_data?: Record<string, unknown> | null;
}

export const updateLog = (id: string, update: UpdateActivityLog): Promise<ActivityLog> =>
  api.put(`/logs/${id}`, update).then((r) => r.data);

export const deleteLogsByType = (activity_type: string): Promise<{ deleted: number }> =>
  api.delete(`/logs/by-type/${encodeURIComponent(activity_type)}`).then((r) => r.data);

export const analyzeData = (question: string): Promise<{ answer: string }> =>
  api.post('/analyze', { question }).then((r) => r.data);

export interface CorrelationPair {
  type_a: string;
  type_b: string;
  r: number | null;
  p_value: number | null;
  n: number;
  significant: boolean;
  warning: string | null;
}

export interface CorrelationsResponse {
  pairs: CorrelationPair[];
  interpretation: string;
  start_date: string | null;
  end_date: string | null;
}

export const analyzeCorrelations = (body: {
  types: string[];
  start_date?: string;
  end_date?: string;
  lag_days?: number;
  windows?: Record<string, number>;
}): Promise<CorrelationsResponse> =>
  api.post('/analyze/correlations', body).then((r) => r.data);

export interface RegressionCoefficient {
  name: string;
  coef: number;
  std_err: number;
  t_stat: number;
  p_value: number;
}

export interface RegressionResponse {
  n: number;
  r_squared: number;
  adj_r_squared: number;
  f_stat: number;
  f_pvalue: number;
  coefficients: RegressionCoefficient[];
  interpretation: string;
}

export const runRegression = (body: {
  response: string;
  predictors: string[];
  start_date?: string;
  end_date?: string;
  log_transform?: string[];
  windows?: Record<string, number>;
}): Promise<RegressionResponse> =>
  api.post('/analyze/regression', body).then((r) => r.data);

export interface Category {
  name: string;
  is_hidden: boolean;
  log_count: number;
}

export const getCategories = (): Promise<Category[]> =>
  api.get('/categories').then((r) => r.data);

export const hideCategory = (name: string): Promise<void> =>
  api.delete(`/categories/${encodeURIComponent(name)}`).then((r) => r.data);

export const deleteCategoryData = (name: string): Promise<{ deleted: number }> =>
  api.delete(`/categories/${encodeURIComponent(name)}/data`).then((r) => r.data);

export const restoreCategory = (name: string): Promise<void> =>
  api.post(`/categories/${encodeURIComponent(name)}/restore`).then((r) => r.data);
