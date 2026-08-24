import path from "node:path";

import {
  ensureLocalService,
  listLocalProjects,
  registerLocalProjectTarget,
  removeLocalProject,
  type Project,
} from "./local-service.ts";

export type ProjectCommand =
  | { action: "list" }
  | { action: "add"; workspacePath: string; name?: string }
  | { action: "remove"; projectId: string };

export function parseProjectCommand(
  argv: string[],
  currentDirectory: string,
): ProjectCommand {
  const [action = "list", ...args] = argv;

  if (action === "list") {
    assertNoExtraArguments(args, "projects list");
    return { action: "list" };
  }

  if (action === "add") {
    let workspacePath = currentDirectory;
    let name: string | undefined;
    let pathSet = false;

    for (let index = 0; index < args.length; index += 1) {
      const value = args[index]!;
      if (value === "--name") {
        const nextValue = args[index + 1];
        if (!nextValue) {
          throw new Error("missing project name after --name");
        }
        name = nextValue;
        index += 1;
        continue;
      }
      if (value.startsWith("-")) {
        throw new Error(`unknown projects add option: ${value}`);
      }
      if (pathSet) {
        throw new Error(`unexpected projects add argument: ${value}`);
      }
      workspacePath = path.resolve(currentDirectory, value);
      pathSet = true;
    }
    return { action: "add", workspacePath, name };
  }

  if (action === "remove") {
    const [projectId, ...extra] = args;
    if (!projectId) {
      throw new Error("missing project id after projects remove");
    }
    assertNoExtraArguments(extra, "projects remove");
    return { action: "remove", projectId };
  }

  throw new Error(`unknown projects command: ${action}`);
}

export async function runProjectCommand(
  command: ProjectCommand,
  client?: ProjectCommandClient,
): Promise<string> {
  const projects = client ?? await localServiceProjectClient();
  if (command.action === "add") {
    const project = await projects.register(command.workspacePath, command.name);
    return formatProject(project);
  }

  if (command.action === "remove") {
    const removed = await projects.remove(command.projectId);
    if (!removed) {
      throw new Error(`project not found: ${command.projectId}`);
    }
    return `removed ${command.projectId}`;
  }

  const registeredProjects = await projects.list();
  if (registeredProjects.length === 0) {
    return "No projects registered.";
  }
  return registeredProjects.map(formatProject).join("\n");
}

type ProjectCommandClient = {
  list(): Promise<Project[]>;
  register(workspacePath: string, name?: string): Promise<Project>;
  remove(projectId: string): Promise<boolean>;
};

async function localServiceProjectClient(): Promise<ProjectCommandClient> {
  const service = await ensureLocalService();
  return {
    list: async () => await listLocalProjects(service),
    register: async (workspacePath, name) =>
      (await registerLocalProjectTarget(service, workspacePath, name)).project,
    remove: async (projectId) => await removeLocalProject(service, projectId),
  };
}

export function projectCommandUsage(): string {
  return [
    "chump projects list",
    "chump projects add [path] [--name <name>]",
    "chump projects remove <project-id>",
  ].join("\n");
}

function formatProject(project: Project): string {
  return `${project.id}\t${project.name}\t${project.workspacePath}`;
}

function assertNoExtraArguments(args: string[], command: string): void {
  if (args.length > 0) {
    throw new Error(`unexpected ${command} argument: ${args[0]}`);
  }
}
