// Expo config plugin for the KMTV Android orientation bridge.
// KMTV Android orientation bridge 的 Expo config plugin.

import type { ConfigPlugin } from "@expo/config-plugins";
import { createRunOncePlugin, withDangerousMod, withMainApplication } from "@expo/config-plugins";
import fs from "node:fs/promises";
import path from "node:path";

const PLUGIN_NAME = "withKmtvOrientation";
const MODULE_CLASS = "KmtvOrientationModule";
const PACKAGE_CLASS = "KmtvReactPackage";

function packageNameToPath(packageName: string): string {
  return packageName.split(".").join(path.sep);
}

function moduleSource(packageName: string): string {
  return `package ${packageName}

import android.app.Activity
import android.content.pm.ActivityInfo
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ${MODULE_CLASS}(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "KmtvOrientation"

  @ReactMethod
  fun setOrientation(mode: String) {
    @Suppress("DEPRECATION")
    val activity: Activity = getCurrentActivity() ?: return
    val orientation = when (mode) {
      "sensorLandscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      else -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }
    activity.runOnUiThread {
      activity.requestedOrientation = orientation
    }
  }
}
`;
}

function packageSource(packageName: string): string {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ${PACKAGE_CLASS} : ReactPackage {
  @Suppress("OVERRIDE_DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(${MODULE_CLASS}(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;
}

async function writeKotlinBridgeAsync(projectRoot: string, packageName: string): Promise<void> {
  const packageDir = path.join(projectRoot, "android", "app", "src", "main", "java", packageNameToPath(packageName));
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, `${MODULE_CLASS}.kt`), moduleSource(packageName));
  await fs.writeFile(path.join(packageDir, `${PACKAGE_CLASS}.kt`), packageSource(packageName));
}

function addKmtvPackage(contents: string): string {
  if (contents.includes(`${PACKAGE_CLASS}()`)) return contents;
  const marker = "PackageList(this).packages.apply {";
  if (!contents.includes(marker)) {
    throw new Error(`${PLUGIN_NAME}: unable to find MainApplication package list`);
  }
  return contents.replace(marker, `${marker}\n          add(${PACKAGE_CLASS}())`);
}

const withKmtvOrientation: ConfigPlugin = (config) => {
  const packageName = config.android?.package;
  if (!packageName) {
    throw new Error(`${PLUGIN_NAME}: android.package is required`);
  }

  config = withDangerousMod(config, ["android", async (modConfig) => {
    await writeKotlinBridgeAsync(modConfig.modRequest.projectRoot, packageName);
    return modConfig;
  }]);

  return withMainApplication(config, (modConfig) => {
    modConfig.modResults.contents = addKmtvPackage(modConfig.modResults.contents);
    return modConfig;
  });
};

export default createRunOncePlugin(withKmtvOrientation, "kmtv-orientation", "1.0.0");
