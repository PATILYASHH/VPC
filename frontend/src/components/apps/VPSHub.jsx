import { useState } from 'react';
import { GitMerge } from 'lucide-react';
import ProjectsGrid from '@/components/vpshub/ProjectsGrid';
import ProjectView from '@/components/vpshub/ProjectView';

export default function VPSHub() {
  const [selectedProject, setSelectedProject] = useState(null);

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Top Bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-card">
        <GitMerge className="w-5 h-5 text-primary" />
        <span className="font-semibold text-lg">VPSHub</span>
        <span className="text-xs text-muted-foreground">Schema Management & Pull Requests</span>
      </div>

      {/* Navigation */}
      {selectedProject ? (
        <ProjectView
          project={selectedProject}
          onBack={() => setSelectedProject(null)}
        />
      ) : (
        <ProjectsGrid onSelectProject={setSelectedProject} />
      )}
    </div>
  );
}
