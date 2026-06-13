// English strings for the Profile tab.
// Profile Tab 的英文文案.

const profile = {
  title: "Me",
  anonymous: "Anonymous User",
  role: { admin: "Admin", user: "Regular User" },
  username: {
    placeholder: "Username",
    edit: "Edit username",
    confirm: "Save",
    cancel: "Cancel",
    updated: "Username updated",
  },
  avatar: {
    change: "Change Avatar",
    remove: "Remove Avatar",
    updated: "Avatar updated",
    removed: "Avatar removed",
    permissionDenied: "Photo library access denied",
  },
  password: {
    title: "Change Password",
    current: "Current Password",
    next: "New Password",
    confirm: "Confirm Password",
    save: "Save Password",
    mismatch: "Passwords don't match",
    empty: "Password cannot be empty",
    changed: "Password changed",
  },
  language: { title: "Language", options: { en: "English", zh: "中文" } },
  theme: { title: "Theme", options: { system: "System", light: "Light", dark: "Dark" } },
  danger: {
    clearHistory: "Clear Watch History",
    historyCleared: "Watch history cleared",
    signOut: "Sign Out",
  },
  admin: { entry: "Admin Panel" },
} as const;

export default profile;
