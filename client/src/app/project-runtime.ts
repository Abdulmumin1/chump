import type { ManagedServerMetadata } from "../core/types.ts";
import {
  ensureManagedServer,
  readManagedServerMetadata,
  stopManagedServer,
} from "./runtime.ts";
import { ProjectRegistryStore } from "./projects.ts";

export type ProjectRuntime = {
  projectId: string;
  status: "stopped" | "running";
  serverUrl: string | null;
  pid: number | null;
};

export type ProjectRuntimeDependencies = {
  ensureServer?: (workspacePath: string) => Promise<{
    started: boolean;
    metadata: ManagedServerMetadata;
  }>;
  readServer?: (workspacePath: string) => Promise<ManagedServerMetadata | null>;
  stopServer?: (workspacePath: string) => Promise<string>;
};

export class ProjectRuntimeSupervisor {
  private readonly projects: ProjectRegistryStore;
  private readonly ensureServer;
  private readonly readServer;
  private readonly stopServer;

  constructor(
    projects = new ProjectRegistryStore(),
    dependencies: ProjectRuntimeDependencies = {},
  ) {
    this.projects = projects;
    this.ensureServer = dependencies.ensureServer ?? ensureManagedServer;
    this.readServer = dependencies.readServer ?? readManagedServerMetadata;
    this.stopServer = dependencies.stopServer ?? stopManagedServer;
  }

  async start(projectId: string): Promise<ProjectRuntime | null> {
    const project = await this.projects.get(projectId);
    if (!project) return null;
    const result = await this.ensureServer(project.workspacePath);
    return runtimeFromMetadata(projectId, result.metadata);
  }

  async status(projectId: string): Promise<ProjectRuntime | null> {
    const project = await this.projects.get(projectId);
    if (!project) return null;
    const metadata = await this.readServer(project.workspacePath);
    return metadata
      ? runtimeFromMetadata(projectId, metadata)
      : stoppedRuntime(projectId);
  }

  async stop(projectId: string): Promise<ProjectRuntime | null> {
    const project = await this.projects.get(projectId);
    if (!project) return null;
    await this.stopServer(project.workspacePath);
    return stoppedRuntime(projectId);
  }

  async stopAll(): Promise<void> {
    const projects = await this.projects.list();
    const results = await Promise.allSettled(
      projects.map(async (project) => {
        const metadata = await this.readServer(project.workspacePath);
        if (metadata) {
          await this.stopServer(project.workspacePath);
        }
      }),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
  }
}

function runtimeFromMetadata(
  projectId: string,
  metadata: ManagedServerMetadata,
): ProjectRuntime {
  return {
    projectId,
    status: "running",
    serverUrl: metadata.url,
    pid: metadata.pid,
  };
}

function stoppedRuntime(projectId: string): ProjectRuntime {
  return {
    projectId,
    status: "stopped",
    serverUrl: null,
    pid: null,
  };
}
