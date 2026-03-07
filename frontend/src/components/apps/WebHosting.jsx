import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProjectList from '@/components/webhosting/ProjectList';
import ProjectDashboard from '@/components/webhosting/ProjectDashboard';

export default function WebHosting() {
  const [selectedProject, setSelectedProject] = useState(null);

  if (selectedProject) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-card">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedProject(null)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{selectedProject.name}</span>
            <span className="text-xs text-muted-foreground font-mono">/{selectedProject.slug}</span>
          </div>
        </div>
        <ProjectDashboard project={selectedProject} onBack={() => setSelectedProject(null)} />
      </div>
    );
  }

  return <ProjectList onSelectProject={setSelectedProject} />;
}
