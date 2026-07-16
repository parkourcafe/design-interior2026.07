import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "space.arhidom.ios",
  appName: "ARHIDOM",
  webDir: "capacitor-web",
  server: {
    url: "https://arhidom.space",
    cleartext: false,
    allowNavigation: ["arhidom.space", "*.arhidom.space"],
  },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#14110d",
    preferredContentMode: "mobile",
  },
};

export default config;
