import { Subsegment } from 'aws-xray-sdk-core'
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Segment } from 'aws-xray-sdk-core';

export type SubsegmentPair = {
    segment: Segment | Subsegment | undefined
    subsegment: Subsegment | undefined
}

export function startTrace(tracer: Tracer, segmentName: string): SubsegmentPair {

    // // Get facade segment created by Lambda
    const segment = tracer.getSegment();
    // Create subsegment for the function and set it as active
    let subSegment;
    if (segment){
        subSegment = segment.addNewSubsegment(segmentName);
        tracer.setSegment(subSegment);
    }
    return { segment: segment, 
            subsegment: subSegment} as SubsegmentPair;
}

export function endTrace (tracer: Tracer, seg: SubsegmentPair) {
    if (seg.subsegment){
        seg.subsegment.close();
    }
    if (seg.segment) {
        tracer.setSegment(seg.segment);
    }
}