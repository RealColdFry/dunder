local ____exports = {}
local function countDown(n)
    while true do
        do
            if not (n > 0) then
                break
            end
            n = n - 1
        end
        ::____continue_0::
    end
    return n
end
local function sumTo(n)
    local i = 0
    local total = 0
    while true do
        do
            if not (i < n) then
                break
            end
            i = i + 1
            total = total + i
        end
        ::____continue_1::
    end
    return total
end
local function doAtLeastOnce(n)
    local i = 0
    while true do
        do
            i = i + 1
        end
        ::____continue_2::
        if not (i < n) then
            break
        end
    end
    return i
end
local function whileBreak()
    local i = 0
    while true do
        do
            if not true then
                break
            end
            if i >= 5 then
                break
            end
            i = i + 1
        end
        ::____continue_3::
    end
    return i
end
local function whileContinue()
    local i = 0
    local evens = 0
    while true do
        do
            if not (i < 10) then
                break
            end
            i = i + 1
            if i % 2 == 1 then
                goto ____continue_4
            end
            evens = evens + 1
        end
        ::____continue_4::
    end
    return evens
end
return ____exports
