import { AisStreamAcceptedMessageType } from './aisstream.message-types';

export interface AisStreamMetaData {
  MMSI?: number | string;
  ShipName?: string;
  time_utc?: string;
}

export interface AisStreamDimension {
  A?: number;
  B?: number;
  C?: number;
  D?: number;
}

interface AisStreamPositionFields {
  Cog?: number;
  Latitude?: number;
  Longitude?: number;
  Sog?: number;
  TrueHeading?: number;
  UserID?: number;
  Valid?: boolean;
}

export interface AisStreamPositionReportPayload extends AisStreamPositionFields {
  NavigationalStatus?: number;
  RateOfTurn?: number;
}

export type AisStreamStandardClassBPositionReportPayload = AisStreamPositionFields;

export interface AisStreamExtendedClassBPositionReportPayload extends AisStreamPositionFields {
  Name?: string;
}

export type AisStreamPositionPayload =
  | AisStreamPositionReportPayload
  | AisStreamStandardClassBPositionReportPayload
  | AisStreamExtendedClassBPositionReportPayload;

export interface AisStreamStaticDataReportPayload {
  ReportA?: { Name?: string; Valid?: boolean };
  ReportB?: {
    CallSign?: string;
    Dimension?: AisStreamDimension;
    ShipType?: number;
    Valid?: boolean;
  };
  UserID?: number;
  Valid?: boolean;
}

export interface AisStreamShipStaticDataPayload {
  CallSign?: string;
  Destination?: string;
  Dimension?: AisStreamDimension;
  ImoNumber?: number;
  Name?: string;
  Type?: number;
  UserID?: number;
  Valid?: boolean;
}

export interface AisStreamEnvelope<TType extends AisStreamAcceptedMessageType, TPayload> {
  MessageType: TType;
  Message?: { [K in TType]?: TPayload };
  MetaData?: AisStreamMetaData;
}

export type AisStreamPositionReportMessage = AisStreamEnvelope<
  'PositionReport',
  AisStreamPositionReportPayload
>;

export type AisStreamStandardClassBPositionReportMessage = AisStreamEnvelope<
  'StandardClassBPositionReport',
  AisStreamStandardClassBPositionReportPayload
>;

export type AisStreamExtendedClassBPositionReportMessage = AisStreamEnvelope<
  'ExtendedClassBPositionReport',
  AisStreamExtendedClassBPositionReportPayload
>;

export type AisStreamStaticDataReportMessage = AisStreamEnvelope<
  'StaticDataReport',
  AisStreamStaticDataReportPayload
>;

export type AisStreamShipStaticDataMessage = AisStreamEnvelope<
  'ShipStaticData',
  AisStreamShipStaticDataPayload
>;

export interface AisStreamUnknownMessage {
  MessageType?: unknown;
  Message?: unknown;
  MetaData?: AisStreamMetaData;
}
