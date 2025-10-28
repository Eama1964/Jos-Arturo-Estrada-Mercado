// FIX: Removed unused and invalid import of 'GroundingSource' from '@google/genai'.

export interface GroundingSource {
  uri: string;
  title: string;
  type: 'search' | 'maps' | 'review';
}

export interface TranscriptEntry {
  speaker: 'user' | 'mary';
  text: string;
  isFinal: boolean;
  id: number;
  feedback?: 'up' | 'down' | null;
  sources?: GroundingSource[];
}

export interface PersonalitySettings {
  empathy: number;
  humor: number;
  solidarity: number;
}

export interface UserLocation {
  latitude: number;
  longitude: number;
}
