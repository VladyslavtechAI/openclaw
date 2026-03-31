/**
 * Observability module — centralized logging, alerting, metrics, and dashboard API.
 */

export {
  EventLogger,
  type ObservabilityEvent,
  type StoredEvent,
  type EventFilter,
  type TimeRange,
  type Metrics,
  type EventLevel,
  type EventCategory,
  type EventLoggerConfig,
} from "./event-logger.js";

export {
  AlertManager,
  type AlertRule,
  type AlertCondition,
  type AlertConditionType,
  type AlertChannel,
  type AlertChannelType,
  type Alert,
  type AlertManagerConfig,
} from "./alert-manager.js";

export {
  MetricsCollector,
  type MetricPoint,
  type StoredMetricPoint,
  type TimeRange as MetricTimeRange,
  type TimeSeries,
  type MetricsSummary,
  type AgentMetric,
  type MetricsCollectorConfig,
} from "./metrics-collector.js";

export {
  DashboardApi,
  type DashboardDeps,
  type DashboardConfig,
} from "./dashboard-api.js";
