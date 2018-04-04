import * as uuid from "uuid"

import * as Hub from "../../hub"

const segment: any = require("analytics-node")

function capitalizeFirstLetter(s: string) {
  if (s) {
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
}

export enum segmentCallTypes {
  Identify = "identify",
  Track = "track",
}

export class SegmentAction extends Hub.Action {

  allowedTags = ["email", "user_id", "segment_anonymous_id"]

  segmentCallType: segmentCallTypes
  name: string
  label: string
  description: string
  iconName = "segment/segment.png"
  params = [
    {
      description: "A write key for Segment.",
      label: "Segment Write Key",
      name: "segment_write_key",
      required: true,
      sensitive: true,
    },
  ]
  supportedActionTypes = [Hub.ActionType.Query]
  supportedFormats = [Hub.ActionFormat.JsonDetail]
  supportedFormattings = [Hub.ActionFormatting.Unformatted]
  supportedVisualizationFormattings = [Hub.ActionVisualizationFormatting.Noapply]
  requiredFields = [{ any_tag: this.allowedTags }]

  constructor(segmentCallType?: segmentCallTypes, minimumSupportedLookerVersion?: string) {
    super()
    this.segmentCallType = segmentCallType || segmentCallTypes.Identify
    this.name = this.segmentCallType === segmentCallTypes.Identify ? "segment" : `segment_${this.segmentCallType}`
    this.label = `Segment ${capitalizeFirstLetter(this.segmentCallType)}`
    this.description = `Add traits via ${this.segmentCallType} to your Segment users.`
    if (minimumSupportedLookerVersion) {
      this.minimumSupportedLookerVersion = minimumSupportedLookerVersion
    }
  }

  async execute(request: Hub.ActionRequest) {
    return new Promise<Hub.ActionResponse>((resolve, reject) => {

      if (!(request.attachment && request.attachment.dataJSON)) {
        reject("No attached json")
        return
      }

      const qr = request.attachment.dataJSON
      if (!qr.fields || !qr.data) {
        reject("Request payload is an invalid format.")
        return
      }

      const fields: any[] = [].concat(...Object.keys(qr.fields).map((k) => qr.fields[k]))
      let hiddenFields = []
      if (request.scheduledPlan &&
          request.scheduledPlan.query &&
          request.scheduledPlan.query.vis_config &&
          request.scheduledPlan.query.vis_config.hidden_fields) {
        hiddenFields = request.scheduledPlan.query.vis_config.hidden_fields
      }

      const identifiableFields = fields.filter((f: any) =>
        f.tags && f.tags.some((t: string) => this.allowedTags.indexOf(t) !== -1),
      )
      if (identifiableFields.length === 0) {
        reject(`Query requires a field tagged ${this.allowedTags.join(" or ")}.`)
        return
      }

      const idField = identifiableFields.filter((f: any) =>
        f.tags && f.tags.some((t: string) => t === "user_id" || t === "segment_anonymous_id"),
      )[0]

      const emailField = identifiableFields.filter((f: any) =>
        f.tags && f.tags.some((t: string) => t === "email"),
      )[0]

      const anonymousIdField = identifiableFields.filter((f: any) =>
        f.tags && f.tags.some((t: string) => t === "segment_anonymous_id"),
      )[0]

      const anonymousId = this.generateAnonymousId()

      const segmentClient = this.segmentClientFromRequest(request)

      const ranAt = qr.ran_at && new Date(qr.ran_at)

      const context = {
        app: {
          name: "looker/actions",
          version: process.env.APP_VERSION,
        },
      }

      for (const row of qr.data) {
        const traits: any = {}
        for (const field of fields) {
          const value = row[field.name].value
          if (!idField || field.name !== idField.name) {
            if (!hiddenFields.includes(field.name)) {
              traits[field.name] = value
            }
          }
          if (emailField && field.name === emailField.name) {
            traits.email = value
          }
        }
        const message: any = {
          anonymousId: anonymousIdField ? row[anonymousIdField.name].value : idField ? null : anonymousId,
          context,
          timestamp: ranAt,
          userId: idField ? row[idField.name].value : null,
        }
        switch (this.segmentCallType) {
          case segmentCallTypes.Identify:
            message.traits = traits
            break
          case segmentCallTypes.Track:
            message.event = ""
            message.properties = traits
            break
        }
        segmentClient[this.segmentCallType](message)
      }

      segmentClient.flush((err: any) => {
        if (err) {
          reject(err)
        } else {
          resolve(new Hub.ActionResponse())
        }
      })

    })
  }

  private segmentClientFromRequest(request: Hub.ActionRequest) {
    return new segment(request.params.segment_write_key)
  }

  private generateAnonymousId() {
    return uuid.v4()
  }

}

Hub.addAction(new SegmentAction(segmentCallTypes.Identify, "4.20.0"))
Hub.addAction(new SegmentAction(segmentCallTypes.Track, "5.5.0"))
