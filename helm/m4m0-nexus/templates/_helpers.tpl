{{- define "nexus.fullname" -}}{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 54 | trimSuffix "-" -}}{{- end -}}
{{- define "nexus.labels" -}}
app.kubernetes.io/name: m4m0-nexus
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end -}}
