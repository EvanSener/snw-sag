export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// A JSON string can expand each input byte to a six-byte Unicode escape.
export const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_BYTES * 6 + 64 * 1024;
