import type { SessionState, SubAgent, TaskInfo } from '../types.js';
import { v4 as uuidv4 } from 'uuid';

export class SessionManager {
  private state: SessionState;

  constructor() {
    this.state = {
      activeSubAgents: [],
    };
  }

  getState(): SessionState {
    return { ...this.state };
  }

  setRepoContext(org: string | undefined, repo: string | undefined, branch?: string): void {
    this.state.currentOrg = org;
    this.state.currentRepo = repo;
    if (branch) {
      this.state.currentBranch = branch;
    }
  }

  getRepoContext(): { org?: string; repo?: string; branch?: string } {
    return {
      org: this.state.currentOrg,
      repo: this.state.currentRepo,
      branch: this.state.currentBranch,
    };
  }

  getFullRepoName(): string | undefined {
    if (this.state.currentOrg && this.state.currentRepo) {
      return `${this.state.currentOrg}/${this.state.currentRepo}`;
    }
    return this.state.currentRepo;
  }

  setBranch(branch: string): void {
    this.state.currentBranch = branch;
  }

  startTask(description: string, userId: string, agent: TaskInfo['agent']): TaskInfo {
    const task: TaskInfo = {
      id: uuidv4(),
      description,
      status: 'running',
      startedAt: new Date(),
      userId,
      agent,
    };
    this.state.currentTask = task;
    return task;
  }

  updateTaskStatus(status: TaskInfo['status']): void {
    if (this.state.currentTask) {
      this.state.currentTask.status = status;
    }
  }

  completeTask(): void {
    if (this.state.currentTask) {
      this.state.currentTask.status = 'completed';
    }
  }

  failTask(): void {
    if (this.state.currentTask) {
      this.state.currentTask.status = 'failed';
    }
  }

  clearTask(): void {
    this.state.currentTask = undefined;
  }

  getCurrentTask(): TaskInfo | undefined {
    return this.state.currentTask;
  }

  addSubAgent(task: string, repo: string): SubAgent {
    const agent: SubAgent = {
      id: uuidv4(),
      task,
      repo,
      status: 'running',
      startedAt: new Date(),
      lastUpdate: 'Starting...',
    };
    this.state.activeSubAgents.push(agent);
    return agent;
  }

  updateSubAgent(id: string, update: Partial<SubAgent>): void {
    const agent = this.state.activeSubAgents.find((a) => a.id === id);
    if (agent) {
      Object.assign(agent, update);
    }
  }

  removeSubAgent(id: string): void {
    this.state.activeSubAgents = this.state.activeSubAgents.filter((a) => a.id !== id);
  }

  getActiveSubAgents(): SubAgent[] {
    return [...this.state.activeSubAgents];
  }

  getSubAgent(id: string): SubAgent | undefined {
    return this.state.activeSubAgents.find((a) => a.id === id);
  }
}
