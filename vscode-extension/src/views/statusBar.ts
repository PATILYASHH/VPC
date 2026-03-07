import * as vscode from 'vscode';
import { PullApiClient } from '../api/client';

export class StatusBarManager {
  private item: vscode.StatusBarItem;
  private client: PullApiClient;

  constructor(client: PullApiClient) {
    this.client = client;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'vpcPull.pull';
    this.item.tooltip = 'VPC Pull: Click to pull schema changes';
  }

  getStatusBarItem(): vscode.StatusBarItem {
    return this.item;
  }

  async refresh(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcPull');
    const url = config.get<string>('serverUrl');
    const key = config.get<string>('apiKey');

    if (!url || !key) {
      this.item.hide();
      return;
    }

    try {
      const status = await this.client.fetchStatus(url, key);
      const pending = status.pending_changes || 0;

      if (pending > 0) {
        this.item.text = `$(cloud-download) VPC: ${pending} pending`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      } else {
        this.item.text = `$(check) VPC: up to date`;
        this.item.backgroundColor = undefined;
      }

      this.item.show();
    } catch {
      this.item.text = `$(warning) VPC: offline`;
      this.item.backgroundColor = undefined;
      this.item.show();
    }
  }

  async showStatus(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcPull');
    const url = config.get<string>('serverUrl');
    const key = config.get<string>('apiKey');

    if (!url || !key) {
      vscode.window.showWarningMessage('VPC Pull not configured. Run "VPC Pull: Configure Connection" first.');
      return;
    }

    try {
      const status = await this.client.fetchStatus(url, key);
      const lines = [
        `Project: ${status.project.name} (${status.project.slug})`,
        `Tracking: ${status.tracking_enabled ? 'enabled' : 'disabled'}`,
        `Total changes: ${status.total_changes}`,
        `Pending: ${status.pending_changes}`,
        `Last pulled: ${status.last_pulled_at ? new Date(status.last_pulled_at).toLocaleString() : 'never'}`,
      ];

      vscode.window.showInformationMessage(lines.join(' | '));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to fetch status: ${err.message}`);
    }
  }
}
