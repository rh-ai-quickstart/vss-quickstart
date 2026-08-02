#!/bin/bash

echo "Installing Observability Operators..."
echo ""

echo "Step 1: Creating namespaces..."
oc create namespace observability-hub --dry-run=client -o yaml | oc apply -f -
oc create namespace openshift-user-workload-monitoring --dry-run=client -o yaml | oc apply -f -
echo "Namespaces created"
echo ""

echo "Step 2: Installing operators..."
helm upgrade --install grafana-op helm/grafana-operator/
helm upgrade --install otel-op helm/otel-operator/
echo "Operators installed"
echo ""

echo "Waiting for operator CRDs to be ready (2-3 minutes)..."
echo ""

echo -n "   Waiting for OpenTelemetryCollector CRD..."
until oc get crd opentelemetrycollectors.opentelemetry.io >/dev/null 2>&1; do
  echo -n "."
  sleep 5
done
echo " done"

echo -n "   Waiting for Grafana CRD..."
until oc get crd grafanas.grafana.integreatly.org >/dev/null 2>&1; do
  echo -n "."
  sleep 5
done
echo " done"

echo ""
echo "All operators ready!"
echo ""
echo "Next step: Run ./deploy.sh to deploy the observability resources"
