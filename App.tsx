import React, { useState, useCallback } from 'react';
import Onboarding from './components/Onboarding';
import LiveView from './components/LiveView';
import { IconAlertTriangle } from './components/IconComponents';

const App: React.FC = () => {
  const [hasPermissions, setHasPermissions] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const handlePermissionsGranted = useCallback(() => {
    setHasPermissions(true);
    setPermissionError(null);
  }, []);

  const handlePermissionsDenied = useCallback((error: Error) => {
    console.error("Permission denied:", error);
    if (error.name === 'NotAllowedError') {
      setPermissionError("Se denegó el acceso a la cámara y al micrófono. Por favor, actívalo en la configuración de tu navegador y actualiza la página.");
    } else {
      setPermissionError(`Ocurrió un error: ${error.message}. Por favor, asegúrate de que tu navegador sea compatible con el acceso a la cámara y al micrófono.`);
    }
  }, []);

  return (
    <div className="w-full h-screen bg-gray-900 text-white flex flex-col items-center justify-center font-sans">
      {!hasPermissions ? (
        <>
          {permissionError ? (
            <div className="p-8 max-w-lg text-center bg-red-900/50 rounded-lg shadow-xl">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-500">
                  <IconAlertTriangle className="h-6 w-6 text-white" />
              </div>
              <h2 className="text-2xl font-bold my-4 text-red-300">Error de Permiso</h2>
              <p className="text-red-200">{permissionError}</p>
            </div>
          ) : (
            <Onboarding onPermissionsGranted={handlePermissionsGranted} onPermissionsDenied={handlePermissionsDenied} />
          )}
        </>
      ) : (
        <LiveView />
      )}
    </div>
  );
};

export default App;