import React from 'react';
import VectorDiagnostics from './VectorDiagnostics';

const DebugVectorPanel: React.FC = () => {
  return (
    <div className="w-full h-full p-6">
      <VectorDiagnostics />
    </div>
  );
};

export default DebugVectorPanel;
