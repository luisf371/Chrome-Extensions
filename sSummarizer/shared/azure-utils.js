// shared/azure-utils.js
// Azure utility constants and functions shared between background.js (via importScripts)
// and options.js (via <script> tag in options.html).
// IMPORTANT: Keep this file free of browser-context-specific APIs so it runs in both contexts.

const DEFAULT_AZURE_API_VERSION = '2024-02-15-preview';

function normalizeAzureResourceName(resource) {
  const raw = (resource || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/\.openai\.azure\.com.*$/i, '')
    .replace(/\/.*$/, '')
    .trim();
}

function buildAzureApiUrl({ apiUrl, azureResource, azureDeployment, azureApiVersion }) {
  const resource = normalizeAzureResourceName(azureResource);
  const deployment = (azureDeployment || '').trim();
  if (!resource || !deployment) {
    return (apiUrl || '').trim();
  }
  const apiVersion = (azureApiVersion || '').trim() || DEFAULT_AZURE_API_VERSION;
  return `https://${resource}.openai.azure.com/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}
