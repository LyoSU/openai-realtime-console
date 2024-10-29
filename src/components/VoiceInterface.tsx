import React, { useState, useEffect } from 'react';
import { Button } from './button/Button';

interface VoiceInterfaceProps {
  onStartRecording: () => void;
  onStopRecording: () => void;
  isListening: boolean;
  isProcessing: boolean;
}

export const VoiceInterface: React.FC<VoiceInterfaceProps> = ({
  onStartRecording,
  onStopRecording,
  isListening,
  isProcessing
}) => {
  return (
    <div className="voice-interface">
      <div className="voice-status">
        {isProcessing && <div className="processing-indicator" />}
        <Button 
          className={`voice-button ${isListening ? 'listening' : ''}`}
          onClick={isListening ? onStopRecording : onStartRecording}
        >
          {isListening ? 'Натисніть, щоб зупинити' : 'Натисніть для розмови'}
        </Button>
      </div>
    </div>
  );
};
