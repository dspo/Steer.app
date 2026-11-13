import { mount, Text, View } from "nsh";
import { locale } from "nsh";
import { setLocale } from "nsh/i18n";
import { containerError, loadContainers, setContainerTransport } from "../core/containers";
import { Workbench } from "../shell/shell";
import { followSystemLocale, shellLocale } from "../ui/i18n";
import { error as sessionError } from "../modules/pi/sessions";
import { registerAllModules } from "../modules/register-all";

registerAllModules();

/** A Chinese system: `setLocale` is what the platform reports to `locale()`. */
setLocale("zh-CN");
followSystemLocale();

setContainerTransport(async (type: string) => {
  switch (type) {
    case "container.list":
      return { containers: [], activeContainerId: null };
    default:
      throw new Error(`locale fixture transport: ${type}`);
  }
});

void loadContainers().then(() => {
  sessionError.set(null);
  containerError.set(null);
  mount(() => (
    <View class="flex-1" style={{ flexDirection: "column", minHeight: 0 }}>
      <Text testID="fixture-locale" class="text-[10px] font-mono">{`system=${locale()} shell=${shellLocale()}`}</Text>
      <View class="flex-1" style={{ minHeight: 0 }}>
        <Workbench />
      </View>
    </View>
  ));
});
