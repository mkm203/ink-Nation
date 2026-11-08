// An error that carries the HTTP status and, optionally, per-field messages.
class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}
module.exports = { HttpError };
