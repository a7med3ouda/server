// will be uncommented when the code finished

// const startCronJob = require('nugttah-backend/helpers/start.cron.job');
// const Helpers = require('nugttah-backend/helpers');
// const Invoice = require('nugttah-backend/modules/invoices');
// const DirectOrder = require('nugttah-backend/modules/direct.orders');
// const Part = require('nugttah-backend/modules/parts');
// const DirectOrderPart = require('nugttah-backend/modules/direct.order.parts');

async function getAllParts() {
  const dps = await DirectOrderPart.Model.find({
    partClass: { $in: ["StockPart", "QuotaPart"] },
    createdAt: { $gt: new Date("2021-04-01") },
    invoiceId: { $exists: false },
    fulfillmentCompletedAt: { $exists: true },
  }).select("_id directOrderId partClass priceBeforeDiscount");

  const all_ps = await Part.Model.find({
    partClass: "requestPart",
    createdAt: { $gt: new Date("2021-04-01") },
    invoiceId: { $exists: false },
    pricedAt: { $exists: true },
    directOrderId: { $exists: true },
  }).select("_id directOrderId partClass premiumPriceBeforeDiscount");

  return all_ps.concat(dps);
}

exports.groupByOrderIdAndFilter = function (dataArray) {
  const result = {};

  dataArray.forEach((ele) => {
    const id = ele.directOrderId;

    if (ele.partClass === "StockPart" || ele.partClass === "QuotaPart") {
      if (result[id] === undefined) {
        result[id] = {
          directOrderPartsIdList: [],
          requestPartsIdList: [],
          total: 0,
        };
      }

      result[id].directOrderPartsIdList.push(ele._id);
      result[id].total += ele.priceBeforeDiscount;
    }

    if (ele.partClass === "requestPart") {
      if (result[id] === undefined) {
        result[id] = {
          directOrderPartsIdList: [],
          requestPartsIdList: [],
          total: 0,
        };
      }
      result[id].requestPartsIdList.push(ele._id);
      result[id].total += ele.premiumPriceBeforeDiscount;
    }
  });

  return Object.entries(result);
};

function calculateInvoices(totalAmount, directOrder, invoces) {
  let { walletPaymentAmount, discountAmount } = directOrder;
  if (directOrder.deliveryFees && invoces.length === 0) {
    totalAmount += directOrder.deliveryFees;
  }

  if (walletPaymentAmount) {
    invoces.forEach((invo) => {
      walletPaymentAmount = Math.min(
        0,
        walletPaymentAmount - invo.walletPaymentAmount
      );
    });
    walletPaymentAmount = Math.min(walletPaymentAmount, totalAmount);
    totalAmount -= walletPaymentAmount;
  }

  if (discountAmount) {
    invoces.forEach((nvc) => {
      discountAmount = Math.min(0, discountAmount - nvc.discountAmount);
    });
    discountAmount = Math.min(discountAmount, totalAmount);
    totalAmount -= discountAmount;
  }

  return {
    totalAmount,
    walletPaymentAmount,
    discountAmount,
  };
}

async function createInvoice() {
  try {
    const allParts = await getAllParts();
    const directOrderPartsGroups = groupByOrderIdAndFilter(allParts);

    const invcs = [];

    for (const allDirectOrderParts of directOrderPartsGroups) {
      const directOrder = await DirectOrder.Model.findOne({
        _id: allDirectOrderParts[0],
      }).select(
        "partsIds requestPartsIds discountAmount deliveryFees walletPaymentAmount"
      );

      // can be better
      const invoces = await Invoice.Model.find({
        directOrderId: allDirectOrderParts[0],
      }).select("walletPaymentAmount discountAmount deliveryFees");

      const { directOrderPartsIdList, requestPartsIdList, total } =
        allDirectOrderParts[1];

      const TotalPrice = Helpers.Numbers.toFixedNumber(total);
      const { deliveryFees } = directOrder;

      const { totalAmount, walletPaymentAmount, discountAmount } =
        calculateInvoices(TotalPrice, directOrder, invoces);

      if (totalAmount < 0) {
        throw Error(
          `Could not create invoice for directOrder: ${directOrder._id} with totalAmount: ${totalAmount}. `
        );
      }

      const invoice = await Invoice.Model.create({
        directOrderId: directOrder._id,
        directOrderPartsIds: directOrderPartsIdList,
        requestPartsIds: requestPartsIdList,
        totalPartsAmount: TotalPrice,
        totalAmount,
        deliveryFees,
        walletPaymentAmount,
        discountAmount,
      });

      await DirectOrder.Model.updateOne(
        { _id: directOrder._id },
        { $addToSet: { invoicesIds: invoice._id } }
      );

      for (const dp_id of directOrderPartsIdList) {
        await DirectOrderPart.Model.updateOne(
          { _id: dp_id },
          { invoiceId: invoice._id }
        );
      }

      // wait for updates before pushing to invoices array
      await requestPartsIdList.map((rp_id) => {
        return new Promise((resolve, reject) => {
          Part.Model.updateOne({ _id: rp_id }, { invoiceId: invoice._id })
            .then(function (result) {
              return resolve();
            })
            .catch(() => {
              reject();
            });
        });
      });

      invcs.push(invoice._id);
    }
    return {
      case: 1,
      message: "invoices created successfully.",
      invoicesIds: invcs,
    };
  } catch (err) {
    Helpers.reportError(err);
  }
}

// will be uncommented when the code finished

// startCronJob("*/1 * * * *", createInvoice, true); // at 00:00 every day

// module.exports = createInvoice;
