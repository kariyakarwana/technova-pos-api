import { calculateWarrantyEndDate } from './warranty-period';

describe('calculateWarrantyEndDate', () => {
  it('starts a calendar-month warranty from the completed sale timestamp', () => {
    const startsAt = new Date('2026-09-14T12:30:45.000Z');

    expect(calculateWarrantyEndDate(startsAt, 12)).toEqual(
      new Date('2027-09-14T12:30:45.000Z'),
    );
  });

  it('keeps month-end warranties inside the target month', () => {
    const startsAt = new Date('2027-01-31T08:15:00.000Z');

    expect(calculateWarrantyEndDate(startsAt, 1)).toEqual(
      new Date('2027-02-28T08:15:00.000Z'),
    );
  });
});
