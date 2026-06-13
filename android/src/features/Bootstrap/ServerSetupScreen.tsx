// ServerSetupScreen lets the user enter a server URL + optional credentials.
// ServerSetupScreen 让用户输入服务器 URL 及可选凭据.

import { useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { localizedMessage, type APIError } from "@/api/apiError";
import { useTheme } from "@/designSystem/useTheme";
import { useAuthStore } from "@/store/authStore";
import { isValidHTTPURL } from "@/utils/urlValidation";

/**
 * Screen where the user supplies the backend URL and optional credentials.
 * 用户输入后端 URL 与可选凭据的屏幕.
 */
export function ServerSetupScreen() {
  const { colors, sizes } = useTheme();
  const { t } = useTranslation(["bootstrap"]);
  const connectServer = useAuthStore((s) => s.connectServer);
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedURL = url.trim();
  const urlInvalid = useMemo(() => {
    return trimmedURL.length > 0 && !isValidHTTPURL(trimmedURL);
  }, [trimmedURL]);
  const canConnect = trimmedURL.length > 0 && !urlInvalid && !connecting;

  async function handleConnect() {
    setConnecting(true);
    setErrorMessage(null);
    try {
      await connectServer(trimmedURL, username.trim(), password);
    } catch (e) {
      const err = e as APIError;
      setErrorMessage(localizedMessage(err));
    } finally {
      setConnecting(false);
    }
  }

  const fieldStyle = {
    borderWidth: 1,
    borderColor: colors.bgSecondary,
    borderRadius: sizes.radius.md,
    padding: 12,
    color: colors.textPrimary,
    backgroundColor: colors.bgCard,
  };

  return (
    <KeyboardAvoidingView
      testID="serverSetupScreen"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.bgPrimary }}
    >
      <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 16 }}>
        <Text style={{ color: colors.textPrimary, fontSize: 28, fontWeight: "700", textAlign: "center" }}>
          {t("bootstrap:title")}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 15, textAlign: "center" }}>
          {t("bootstrap:subtitle")}
        </Text>

        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.textSecondary, fontWeight: "600" }}>{t("bootstrap:serverLabel")}</Text>
          <TextInput
            testID="serverURLField"
            value={url}
            onChangeText={setUrl}
            placeholder={t("bootstrap:serverPlaceholder")}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[fieldStyle, urlInvalid ? { borderColor: "red" } : null]}
          />
          {urlInvalid ? (
            <Text style={{ color: "red", fontSize: 12 }}>{t("bootstrap:invalidURL")}</Text>
          ) : null}
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.textSecondary, fontWeight: "600" }}>{t("bootstrap:accountLabel")}</Text>
          <TextInput
            testID="usernameField"
            value={username}
            onChangeText={setUsername}
            placeholder={t("bootstrap:usernamePlaceholder")}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={fieldStyle}
          />
          <TextInput
            testID="passwordField"
            value={password}
            onChangeText={setPassword}
            placeholder={t("bootstrap:passwordPlaceholder")}
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            style={fieldStyle}
          />
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{t("bootstrap:anonymousHint")}</Text>
        </View>

        {errorMessage ? (
          <Text testID="errorMessage" style={{ color: "red", fontSize: 13 }}>{errorMessage}</Text>
        ) : null}

        <Pressable
          testID="connectButton"
          disabled={!canConnect}
          onPress={handleConnect}
          accessibilityState={{ disabled: !canConnect }}
          style={{
            backgroundColor: canConnect ? colors.accent : colors.bgSecondary,
            padding: 14,
            borderRadius: sizes.radius.md,
            alignItems: "center",
          }}
        >
          {connecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "600" }}>{t("bootstrap:connect")}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
