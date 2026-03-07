import * as vscode from 'vscode';
import { VpcScmProvider } from '../scm/vpcScmProvider';

export function registerStageCommands(
  context: vscode.ExtensionContext,
  scmProvider: VpcScmProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('vpcSync.stage', (resource: vscode.SourceControlResourceState) => {
      scmProvider.stage(resource.resourceUri);
    }),

    vscode.commands.registerCommand('vpcSync.unstage', (resource: vscode.SourceControlResourceState) => {
      scmProvider.unstage(resource.resourceUri);
    }),

    vscode.commands.registerCommand('vpcSync.stageAll', () => {
      scmProvider.stageAll();
    }),

    vscode.commands.registerCommand('vpcSync.unstageAll', () => {
      scmProvider.unstageAll();
    }),
  );
}
