import Logger from "@reactioncommerce/logger";
import ReactionError from "@reactioncommerce/reaction-error";
import { CommonOrder } from "/imports/plugins/core/orders/server/no-meteor/simpleSchemas";
import { getTaxServicesForShop } from "../registration";
import { TaxServiceResult } from "../../../lib/simpleSchemas";

/**
 * @summary Returns all taxes that apply to a provided order, delegating to a more specific
 *   tax calculation service for the actual calculations.
 * @param {Object} context App context
 * @param {Object} order Relevant information about an order. This is similar to an OrderFulfillmentGroup type.
 * @param {Boolean} forceZeroes Set to `true` to force tax properties to be added
 *   and set to 0 when no tax plugin is enabled. When calculating tax for a cart, this should be false.
 *   When calculating tax for an order, this should be true.
 * @returns {Object} Calculated tax information. Has `taxSummary` property in `TaxSummary` schema
 *   as well as `itemTaxes` array property with `itemId`, `tax`, `taxableAmount`,
 *   and `taxes` properties on each array item.
 */
export default async function getFulfillmentGroupTaxes(context, { order, forceZeroes }) {
  try {
    CommonOrder.validate(order);
  } catch (error) {
    Logger.error("Invalid order input provided to getFulfillmentGroupTaxes", error);
    throw new ReactionError("internal-error", "Error while calculating taxes");
  }

  const { items, shopId } = order;

  const { activeTaxService, fallbackTaxService } = await getTaxServicesForShop(context, shopId);

  const defaultReturnValue = {
    taxSummary: {
      calculatedAt: new Date(),
      tax: 0,
      taxableAmount: 0,
      taxes: []
    },
    itemTaxes: items.map((item) => ({ itemId: item._id, tax: 0, taxableAmount: 0, taxes: [] }))
  };

  if (!activeTaxService) {
    return forceZeroes ? defaultReturnValue : { itemTaxes: [], taxSummary: null };
  }

  let taxServiceResult;
  try {
    taxServiceResult = await activeTaxService.functions.calculateOrderTaxes({ context, order });
  } catch (error) {
    Logger.error(`Error in calculateOrderTaxes for the active tax service (${activeTaxService.displayName})`, error);
    // TODO: Maybe check for specific error failure before using fallbackTaxService
    if (fallbackTaxService) {
      Logger.info("Primary tax service calculation failed. Using set fallback tax service");
      try {
        taxServiceResult = await fallbackTaxService.functions.calculateOrderTaxes({ context, order });
      } catch (fallbackError) {
        Logger.error(`Error in calculateOrderTaxes for the fallback tax service (${fallbackTaxService.displayName})`, fallbackError);
        throw new ReactionError("internal-error", "Error while calculating taxes");
      }
    } else {
      throw new ReactionError("internal-error", "Error while calculating taxes");
    }
  }

  // The tax service may return `null` if it can't calculate due to missing info
  if (!taxServiceResult) {
    return forceZeroes ? defaultReturnValue : { itemTaxes: [], taxSummary: null };
  }

  try {
    TaxServiceResult.validate(taxServiceResult);
  } catch (error) {
    Logger.error(`Invalid return from calculateOrderTaxes for the active tax service (${activeTaxService.displayName})`, error);
    throw new ReactionError("internal-error", "Error while calculating taxes");
  }

  return taxServiceResult;
}
