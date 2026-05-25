const errors = {
  generic: "Something went wrong, please try again.",
  network: "Network error, please check your connection.",
  unauthorized: "Please sign in first.",
  forbidden: "You do not have access to this resource.",
  notFound: "Resource not found.",
  validation: "Invalid input, please check and try again.",
  saveFailed: "Save failed, please try again later.",
  loadFailed: "Load failed, please try again later.",
  importFailed: "Import failed, please try again later.",
  invalidJSON: "Invalid JSON.",
} as const;

export default errors;
