import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PipelineList from '@/components/pipeline/PipelineList';
import PipelineDashboard from '@/components/pipeline/PipelineDashboard';

export default function Pipeline() {
  const [selectedPipeline, setSelectedPipeline] = useState(null);

  if (selectedPipeline) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-card">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedPipeline(null)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-semibold">{selectedPipeline.name}</span>
          {selectedPipeline.description && (
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              {selectedPipeline.description}
            </span>
          )}
        </div>
        <PipelineDashboard pipeline={selectedPipeline} />
      </div>
    );
  }

  return <PipelineList onSelectPipeline={setSelectedPipeline} />;
}
