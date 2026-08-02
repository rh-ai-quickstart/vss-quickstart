{{- define "otel-collector.name" -}}
{{- default .Chart.Name .Values.common.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "otel-collector.fullname" -}}
{{- if .Values.common.fullnameOverride }}
{{- .Values.common.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.common.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "otel-collector.namespace" -}}
{{- .Values.global.namespace | default .Release.Namespace }}
{{- end }}

{{- define "otel-collector.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "otel-collector.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "otel-collector.serviceAccountName" -}}
{{- .Values.serviceAccount.name | default (include "otel-collector.fullname" .) }}
{{- end }}
