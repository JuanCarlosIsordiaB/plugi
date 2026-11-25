import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { StationProposals } from './station-proposals.service.js';
import {
  reportInput,
  reviewDecision,
  stationCreateInput,
  stationFilter,
  stationInput,
} from './station-input.js';
import { Stations } from './stations.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

@Controller('api/v1')
export class StationsController {
  constructor(
    @Inject(Stations) private readonly stations: Stations,
    @Inject(StationProposals) private readonly proposals: StationProposals,
  ) {}

  @Get('connector-types')
  types() {
    return this.stations.connectorTypes();
  }

  @Get('stations')
  list(@Query() query: unknown) {
    return this.stations.list(stationFilter(query));
  }

  @Get('stations/:id')
  detail(@Param('id', uuid) id: string) {
    return this.stations.detail(id);
  }

  @Post('stations')
  create(@Body() body: unknown, @Headers('authorization') header?: string) {
    return this.stations.create(header, stationCreateInput(body));
  }

  @Post('stations/:id/chargers/:chargerId/reports')
  report(
    @Param('id', uuid) id: string,
    @Param('chargerId', uuid) chargerId: string,
    @Body() body: unknown,
    @Headers('authorization') header?: string,
  ) {
    return this.stations.report(header, id, chargerId, reportInput(body));
  }

  @Post('station-proposals')
  @Header('Cache-Control', 'no-store')
  propose(@Body() body: unknown, @Headers('authorization') header?: string) {
    return this.proposals.create(header, stationInput(body));
  }

  @Get('station-proposals')
  @Header('Cache-Control', 'no-store')
  mine(@Headers('authorization') header?: string) {
    return this.proposals.mine(header);
  }

  @Get('station-proposals/:id')
  @Header('Cache-Control', 'no-store')
  ownProposal(
    @Param('id', uuid) id: string,
    @Headers('authorization') header?: string,
  ) {
    return this.proposals.ownProposal(header, id);
  }

  @Get('admin/station-proposals')
  @Header('Cache-Control', 'no-store')
  pending(@Headers('authorization') header?: string) {
    return this.proposals.pending(header);
  }

  @Post('admin/station-proposals/:id/review')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  review(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @Headers('authorization') header?: string,
  ) {
    return this.proposals.review(header, id, reviewDecision(body));
  }
}
