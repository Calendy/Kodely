import { amplitudeTracker } from "."
import { AmplitudeWebviewMessage } from "../../shared/WebviewMessage"

export class AmplitudeWebviewManager {
	static handleMessage(message: AmplitudeWebviewMessage) {
		switch (message.event_type) {
			case "ExtensionCreditAddOpen":
				amplitudeTracker.addCreditsClick()
				break
			case "ReferralProgram":
				amplitudeTracker.referralProgramClick()
				break
			case "AuthExtension":
				amplitudeTracker.authExtension()
				break
			case "TrialOfferView":
				amplitudeTracker.trialOfferView()
				break
			case "TrialOfferStart":
				amplitudeTracker.trialOfferStart()
				break
			case "TrialUpsellView":
				amplitudeTracker.trialUpsellView()
				break
			case "TrialUpsellStart":
				amplitudeTracker.trialUpsellStart()
				break
		}
	}
}
