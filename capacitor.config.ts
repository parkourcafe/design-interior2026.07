import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "space.arhidom.ios",
  appName: "RemHaOS",
  webDir: "capacitor-web",
  server: {
    url: "https://www.remhaos.com/app",
    cleartext: false,
    allowNavigation: ["www.remhaos.com"],
  },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#14110d",
    preferredContentMode: "mobile",
  },
};

export default config;
