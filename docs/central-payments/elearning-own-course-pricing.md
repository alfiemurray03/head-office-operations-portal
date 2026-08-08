# Sousa Murray eLearning individual course price governance

Head Office Central Payments is authoritative for individual Sousa Murray eLearning course pricing.

## Approved bands

The governed customer-facing VAT-inclusive prices are £7.99, £11.00, £13.99, £16.99, £22.99 and £29.99.

Each band starts from an internal course base value. Central Payments applies a 30% commercial uplift and then UK standard-rate VAT at 20%. The 30% figure is not recorded or described as VAT.

## Band selection

The connected eLearning catalogue supplies factual course metrics: level, duration, module count, lesson count and final-assessment question count. Head Office recalculates the complexity score and expected band. Catalogue sync fails when the connected site's declared band, base value, net amount, VAT amount or gross amount differs from the Head Office calculation.

## Stripe catalogue

Each Sousa Murray course has its own Stripe Product and active one-time Price. Product and Price metadata include the pricing band, internal base value, 30% uplift basis points, 20% VAT basis points and manual-sale permission. Website checkout references the governed catalogue Price for Sousa Murray course lines.

Course access duration remains a separate Head Office commercial control and must be configured before online paid-course fulfilment can be enabled.
