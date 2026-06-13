const categories = {
  title: "Categories",
  loading: "Loading categories",
  retry: "Retry",
  error: {
    title: "Failed to load categories",
    description: "Check your connection and try again.",
  },
  empty: {
    title: "No results",
    description: "Adjust the filter and try again.",
  },
  loadingMore: "Loading more",
} as const;

export default categories;
