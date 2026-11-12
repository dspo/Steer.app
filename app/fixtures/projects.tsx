import { mount, Text, View } from "nsh";
import { Workbench } from "../shell/shell";
import { activeContainerId, containers, layout, setContainerTransport, syncVisible } from "../stores/containers";
import { browserPages } from "../stores/browser";
import { panelIds } from "../stores/dock";
import { phase } from "../stores/engine";
import { containerProject, membership, projects, setProjectTransport } from "../stores/projects";
import { seedSession } from "../stores/sessions";
import { defaultLayoutForSessions } from "../stores/dock";
import { setFolderPicker } from "../stores/picker";

// Headless tests never launch Finder: the picker answers with the next
// folder in this list, so the dialog's add/remove/primary flow is real.
const pickedFolders = ["/tmp/zu-project-one", "/tmp/zu-project-two", "/tmp/zu-project-three"];
let picked = 0;
setFolderPicker(async () => pickedFolders[picked++] ?? null);

seedSession("s1", [{ role: "assistant", text: "alpha body" }], {
  path: "/tmp/p-alpha.jsonl",
  name: "Alpha",
  loaded: true,
});
seedSession("s2", [{ role: "assistant", text: "beta body" }], {
  path: "/tmp/p-beta.jsonl",
  name: "Beta",
  loaded: true,
});

const projectOne = {
  id: "p1",
  name: "Project One",
  nameOverridden: true,
  roots: [{ path: "/tmp", primary: true }],
  position: 0,
  createdAt: 1,
  updatedAt: 1,
};
const projectTwo = {
  id: "p2",
  name: "Project Two",
  nameOverridden: true,
  roots: [{ path: "/tmp", primary: true }],
  position: 1,
  createdAt: 1,
  updatedAt: 1,
};

const records: any[] = [
  { id: "c1", kind: "Pi", cwd: "/tmp", archived: false, createdAt: 1, updatedAt: 3, projectId: "p1", sessions: [{ sessionId: "s1", path: "/tmp/p-alpha.jsonl", name: "Alpha" }] },
  { id: "c2", kind: "Pi", cwd: "/tmp", archived: false, createdAt: 1, updatedAt: 2, projectId: "p2", sessions: [{ sessionId: "s2", path: "/tmp/p-beta.jsonl", name: "Beta" }] },
];

let projectList: any[] = [projectOne, projectTwo];
let membershipMap: Record<string, string | null> = { c1: "p1", c2: "p2" };
let active = "c1";
/** Layouts written by the store (switching a container reads them back). */
const layouts: Record<string, { layout: any; zoom: string | null }> = {};

projects.set([projectOne, projectTwo] as any);
containers.set(records);
membership.set(membershipMap);
activeContainerId.set("c1");
layout.set(defaultLayoutForSessions(["s1"]));
syncVisible();
phase.set("connected");

async function containerTransport(type: string, payload: any = {}): Promise<any> {
  switch (type) {
    case "container.list":
      return { containers: records, activeContainerId: active };
    case "container.show": {
      active = payload.containerId;
      return { container: records.find((row) => row.id === payload.containerId) };
    }
    case "layout.get":
      return {
        containerId: payload.containerId,
        ...(layouts[payload.containerId] ?? { layout: null, zoom: null }),
      };
    case "container.create": {
      const id = `c${records.length + 1}`;
      const sessionId = `s${records.length + 1}`;
      const record = {
        id,
        kind: "Pi",
        cwd: payload.cwd ?? "/tmp",
        archived: false,
        createdAt: 5,
        updatedAt: 5,
        projectId: payload.projectId ?? null,
        sessions: [{ sessionId, path: `/tmp/${sessionId}.jsonl`, name: "Chat" }],
      };
      records.push(record);
      containers.set([...records]);
      active = id;
      return {
        container: record,
        session: { id: sessionId, path: `/tmp/${sessionId}.jsonl`, cwd: record.cwd, name: "Chat", containerId: id, messages: [] },
      };
    }
    case "layout.put":
      layouts[payload.containerId] = { layout: payload.layout, zoom: payload.zoom };
      return { containerId: payload.containerId, layout: payload.layout, zoom: payload.zoom };
    default:
      throw new Error(`project fixture container transport: ${type}`);
  }
}

async function projectTransport(type: string, payload: any = {}): Promise<any> {
  switch (type) {
    case "project.list":
      return { projects: projectList, membership: membershipMap };
    case "project.setMembership": {
      const next = { ...membershipMap };
      if (payload.projectId === null) delete next[payload.containerId];
      else next[payload.containerId] = payload.projectId;
      membershipMap = next;
      membership.set(next);
      records.forEach((row) => {
        if (row.id === payload.containerId) row.projectId = payload.projectId;
      });
      containers.set([...records]);
      return { container: records.find((row) => row.id === payload.containerId), projects: projectList, membership: next };
    }
    case "project.create": {
      const project = {
        id: `p${projectList.length + 1}`,
        name: payload.name || "project",
        nameOverridden: true,
        roots: payload.roots,
        position: projectList.length,
        createdAt: 5,
        updatedAt: 5,
      };
      projectList = [...projectList, project];
      projects.set([...projectList] as any);
      return { project, projects: projectList, membership: membershipMap };
    }
    default:
      throw new Error(`project fixture transport: ${type}`);
  }
}

/** The store read out loud: the canvas's sheets, the canvas itself, pages. */
function Probe() {
  const pages = () =>
    Object.entries(browserPages())
      .map(([id, page]) => `${id}=${page.url ?? ""}`)
      .join("+");
  const project = () => {
    const row = containers().find((container) => container.id === activeContainerId());
    return row ? containerProject(row) ?? "null" : "none";
  };
  return (
    <Text testID="fixture-state" class="text-[10px] font-mono text-foreground">
      {`panels=${panelIds(layout()).join(",")} active=${activeContainerId() ?? "scratch"} project=${project()} pages=${pages()}`}
    </Text>
  );
}

setContainerTransport(containerTransport);
setProjectTransport(projectTransport);
mount(() => (
  <View class="flex-1" style={{ flexDirection: "column", minHeight: 0 }}>
    <Probe />
    <View class="flex-1" style={{ minHeight: 0 }}>
      <Workbench />
    </View>
  </View>
));
