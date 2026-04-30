local ____exports = {}
local function findFirstEven(n)
    do
        local i = 0
        while true do
            do
                if not (i < n) then
                    break
                end
                if i == 0 then
                    goto ____continue_0
                end
                if i % 2 == 0 then
                    return i
                end
                if i > 100 then
                    break
                end
            end
            ::____continue_0::
            i = i + 1
        end
    end
    return -1
end
local ____call_arg_0 = print
____call_arg_0(findFirstEven(20))
return ____exports
