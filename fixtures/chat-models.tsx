import { mount } from "nsh";
import { seedSession } from "../sessions";
import { SessionBody } from "../sheets";
import { visiblePanels } from "../dock";
import { installModelTransport, MODEL_SEED } from "./chat-models-data";

// The model picker's data without an engine: `session.models` answers with two
// providers, and `session.setModel` replies with the same `session.info` shape
// a real session would, so choosing a model moves the trigger's label.

installModelTransport();
seedSession("models", [], MODEL_SEED);
visiblePanels.set(["session:models"]);

mount(() => <SessionBody id="models" sheetId="session:models" />);
