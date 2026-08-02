#!/bin/bash

echo "Uninstalling Observability Stack..."
echo ""

echo "Step 1: Uninstalling MLflow..."
helm uninstall mlflow -n vss 2>/dev/null || echo "   (not installed)"
echo ""

echo "Step 2: Uninstalling Grafana..."
helm uninstall grafana -n observability-hub 2>/dev/null || echo "   (not installed)"
echo ""

echo "Step 3: Uninstalling OTEL Collector..."
helm uninstall otel-collector -n observability-hub 2>/dev/null || echo "   (not installed)"
echo ""

echo "Step 4: Uninstalling User Workload Monitoring..."
helm uninstall uwm 2>/dev/null || echo "   (not installed)"
echo ""

echo "Step 5: Uninstalling Operators..."
helm uninstall otel-op 2>/dev/null || echo "   otel-op (not installed)"
helm uninstall grafana-op 2>/dev/null || echo "   grafana-op (not installed)"
echo ""

echo "Observability stack uninstallation complete!"
echo ""
echo "Note: You may need to manually remove the user-workload-monitoring ConfigMap:"
echo "  oc delete configmap cluster-monitoring-config -n openshift-monitoring"
echo ""
echo "Namespaces and resources may take time to fully delete."
echo "Check with: oc get namespaces | grep observability"
