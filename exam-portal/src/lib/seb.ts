/**
 * Safe Exam Browser utilities for the exam portal.
 */

/**
 * Checks if the current browser is Safe Exam Browser by examining the User-Agent.
 * SEB's User-Agent contains "SEB" (case-insensitive).
 */
export function isRunningInSeb(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.toLowerCase().includes("seb");
}

/**
 * Generates the seb:// launch URL for an exam batch.
 * This URL opens SEB with the config downloaded from the server.
 */
export function getSebLaunchUrl(
  examBatchId: string,
  startUrl?: string,
): string {
  const origin = window.location.origin;
  const configUrl = `${origin}/api/v1/seb/${examBatchId}/config.seb`;
  const url = `seb://${configUrl}`;
  if (startUrl) {
    return `${url}?starturl=${encodeURIComponent(startUrl)}`;
  }
  return `${url}?starturl=${encodeURIComponent(`${origin}/examportal/`)}`;
}

/**
 * Generates the direct download URL for the .seb config file.
 */
export function getSebConfigDownloadUrl(examBatchId: string): string {
  return `${window.location.origin}/api/v1/seb/${examBatchId}/config.seb`;
}

/**
 * Attempts to launch SEB via the seb:// protocol handler.
 * Falls back to downloading the .seb config file if the protocol fails.
 */
export function launchSeb(examBatchId: string, startUrl?: string): void {
  const launchUrl = getSebLaunchUrl(examBatchId, startUrl);

  // Try to open via seb:// protocol
  window.location.href = launchUrl;

  // Fallback: after 3 seconds, if SEB didn't launch, offer config download
  setTimeout(() => {
    const downloadUrl = getSebConfigDownloadUrl(examBatchId);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `exam_${examBatchId}.seb`;
    link.click();
  }, 3000);
}
