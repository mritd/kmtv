const account = {
  title: "Profile",
  eyebrow: "Account",
  description: "Manage profile info, sign out and appearance preferences.",
  profile: "Account",
  themeSection: "Appearance",
  changePassword: "Change password",
  savePreferences: "Save preferences",
  usernameLabel: "Username",
  saveProfile: "Save profile",
  logout: "Sign out",
  roleAdmin: "Administrator",
  roleUser: "User",
  anonymousBadge: "Anonymous",
  updateSuccess: "Profile updated; the token snapshot syncs after the next sign-in.",
  updateFailed: "Failed to update profile",
  avatar: {
    uploadButton: "Upload avatar",
    uploadPending: "Uploading...",
    deleteButton: "Remove avatar",
    deletePending: "Removing...",
    uploadSuccess: "Avatar updated",
    uploadFailed: "Failed to upload avatar",
    deleteSuccess: "Avatar removed",
    deleteFailed: "Failed to remove avatar",
    errorType: "Only JPEG, PNG, GIF, or WEBP images are accepted",
    errorTooLarge: "Image must be 256 KB or smaller",
    hint: "JPEG / PNG / GIF / WEBP, up to 256 KB",
  },
  loginPromptCard: {
    title: "Sign in to manage your profile",
    description: "Anonymous mode can't edit username, avatar, or password. Sign in to save favorites and unlock more features.",
    action: "Sign in",
  },
  theme: {
    sectionTitle: "Page theme",
    description: "Theme settings only affect this browser; the server config is untouched.",
    customPaletteTitle: "Custom Palette",
    customPaletteDescription: "Pick your own background, surface, accent, and text colors.",
    resetButton: "Reset to default",
    themes: {
      graphite: {
        label: "Graphite Cinema",
        description: "Cold white and graphite black. The default quiet cinema theme.",
      },
      nocturne: {
        label: "Nocturne Blue",
        description: "Dark blue-black with restrained mist-blue accents.",
      },
      "tech-purple": {
        label: "Tech Purple",
        description: "Deep-space dark with restrained technology-purple accents.",
      },
    },
  },
} as const;

export default account;
