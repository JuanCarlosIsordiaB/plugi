export const proposalsPath = '/station-proposals';

export interface ConnectorType {
  id: string;
  label: string;
}

interface ProposedCharger {
  label: string;
  connectorTypes: string[];
  latitude: number | null;
  longitude: number | null;
}

export interface ProposedStation {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  chargers: ProposedCharger[];
}

export interface Proposal {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  station: ProposedStation;
  stationId: string | null;
  createdAt: string;
  reviewedAt: string | null;
}
