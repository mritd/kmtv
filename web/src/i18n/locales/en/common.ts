const common = {
  brand: "KMTV",
  actions: {
    confirm: "Confirm",
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    edit: "Edit",
    create: "Create",
    close: "Close",
    retry: "Retry",
    import: "Import",
    sync: "Sync",
    check: "Check",
    enable: "Enable",
    disable: "Disable",
    search: "Search",
  },
  states: {
    loading: "Loading",
    empty: "No content",
    error: "Something went wrong",
    success: "Success",
  },
  pluralization: {
    items: "{{count}} items",
  },
  date: {
    missing: "no date",
  },
} as const;

export default common;
