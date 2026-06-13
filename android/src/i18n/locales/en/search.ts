const search = {
  title: "Search",
  placeholder: "Search videos...",
  history: {
    heading: "Search history",
    clear: "Clear",
  },
  progress: {
    searching: "Searching available sources {{completed}} / {{total}} ...",
    probing: "Probing CDN availability {{completed}} / {{total}} ...",
    starting: "Searching...",
  },
  empty: {
    noResults: "No results found",
  },
  error: {
    generic: "Search failed",
    retry: "Retry",
  },
} as const;

export default search;
