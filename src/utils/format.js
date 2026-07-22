/**
 * ★ Shared formatting utilities
 * ลดการ duplicate formatBytes/formatFileSize ที่กระจายอยู่ 4+ ไฟล์
 */

/**
 * Format bytes to human-readable string (e.g. "1.5 MB")
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = { formatBytes };
