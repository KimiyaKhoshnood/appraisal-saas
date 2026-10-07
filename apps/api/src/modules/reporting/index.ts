import { Module } from '@nestjs/common';
import { EvaluationModule } from '../evaluation';
import { ReportingController } from './reporting.controller';

/** reporting (optional module): feature-gated reports and analytics. Depends on: evaluation, configuration. */
@Module({
  imports: [EvaluationModule],
  controllers: [ReportingController],
})
export class ReportingModule {}

export { csvCell } from './reporting.controller';
