// One response envelope everywhere: { success: true, data } or { success: false, error }.
export function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
