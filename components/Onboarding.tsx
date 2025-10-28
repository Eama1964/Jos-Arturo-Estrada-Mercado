import React, { useState } from 'react';
import { IconCamera, IconLoader } from './IconComponents';

interface OnboardingProps {
  onPermissionsGranted: () => void;
  onPermissionsDenied: (error: Error) => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onPermissionsGranted, onPermissionsDenied }) => {
  const [isRequesting, setIsRequesting] = useState(false);

  const handleStart = async () => {
    setIsRequesting(true);
    try {
      // Request permissions to ensure they are granted before moving on
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'environment' } });
      // Stop the tracks immediately as they will be requested again in the LiveView
      stream.getTracks().forEach(track => track.stop());
      onPermissionsGranted();
    } catch (error) {
      if (error instanceof Error) {
        onPermissionsDenied(error);
      } else {
        onPermissionsDenied(new Error('An unknown error occurred while requesting permissions.'));
      }
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <div className="mb-6">
            <h1 className="text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
                Mary Jose Camino
            </h1>
            <p className="mt-2 text-xl text-gray-300">Tu Amiga IA en Tiempo Real</p>
        </div>
        <div className="max-w-md mx-auto mb-8 text-gray-400">
            <p>
                ¿Lista para conversar? Mary Jose Camino puede ver tu mundo a través de tu cámara y charlar contigo en tiempo real.
                Por favor, concede acceso a la cámara y al micrófono para comenzar.
            </p>
        </div>
        <button
            onClick={handleStart}
            disabled={isRequesting}
            className="flex items-center justify-center px-8 py-4 bg-purple-600 text-white font-bold rounded-full shadow-lg hover:bg-purple-700 disabled:bg-purple-900 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-purple-400 focus:ring-opacity-50"
        >
            {isRequesting ? (
                <>
                    <IconLoader className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" />
                    Solicitando...
                </>
            ) : (
                <>
                    <IconCamera className="-ml-1 mr-3 h-5 w-5 text-white" />
                    Iniciar Conversación
                </>
            )}
        </button>
    </div>
  );
};

export default Onboarding;